//! Graba lo que suena por los altavoces (captura «loopback» de WASAPI) para
//! que SHAZAM reconozca una canción con un solo clic, sin elegir ventana.

use std::sync::atomic::{AtomicBool, Ordering};

static RECORDING: AtomicBool = AtomicBool::new(false);
static STOP: AtomicBool = AtomicBool::new(false);

/// WAV mono de 16 bits a partir de muestras en [-1, 1].
#[cfg_attr(not(windows), allow(dead_code))]
fn wav_bytes(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

#[cfg(windows)]
fn capture(seconds: u32) -> Result<Vec<u8>, String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use cpal::{FromSample, Sample, SampleFormat, SizedSample};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or("No hay ningún dispositivo de salida de audio activo.")?;
    let config = device
        .default_output_config()
        .map_err(|error| format!("No se pudo leer la salida de audio: {error}"))?;
    let channels = config.channels().max(1) as usize;
    let sample_rate = config.sample_rate().0;
    let limit = sample_rate as usize * seconds as usize;
    let samples: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::with_capacity(limit)));

    fn build<T>(device: &cpal::Device, config: &cpal::StreamConfig, channels: usize, limit: usize, sink: Arc<Mutex<Vec<f32>>>) -> Result<cpal::Stream, cpal::BuildStreamError>
    where
        T: SizedSample,
        f32: FromSample<T>,
    {
        device.build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                let mut buffer = match sink.lock() { Ok(buffer) => buffer, Err(_) => return };
                for frame in data.chunks(channels) {
                    if buffer.len() >= limit { break; }
                    let sum: f32 = frame.iter().map(|sample| f32::from_sample(*sample)).sum();
                    buffer.push(sum / channels as f32);
                }
            },
            |error| eprintln!("[shazam] error de captura: {error}"),
            None,
        )
    }

    let stream_config: cpal::StreamConfig = config.clone().into();
    let sink = samples.clone();
    // En WASAPI, abrir un flujo de entrada sobre un dispositivo de salida
    // graba lo que ese dispositivo está reproduciendo (loopback).
    let stream = match config.sample_format() {
        SampleFormat::F32 => build::<f32>(&device, &stream_config, channels, limit, sink),
        SampleFormat::I16 => build::<i16>(&device, &stream_config, channels, limit, sink),
        SampleFormat::I32 => build::<i32>(&device, &stream_config, channels, limit, sink),
        SampleFormat::U16 => build::<u16>(&device, &stream_config, channels, limit, sink),
        other => return Err(format!("Formato de audio no compatible: {other}")),
    }
    .map_err(|error| format!("No se pudo escuchar el audio del sistema: {error}"))?;
    stream.play().map_err(|error| format!("No se pudo empezar a escuchar: {error}"))?;

    let started = Instant::now();
    let deadline = Duration::from_secs(seconds as u64 + 2);
    loop {
        std::thread::sleep(Duration::from_millis(100));
        let filled = samples.lock().map(|buffer| buffer.len()).unwrap_or(0);
        // Al detener a mano, basta con unos segundos para reconocer.
        let stopped = STOP.load(Ordering::Relaxed) && started.elapsed() >= Duration::from_secs(3);
        if filled >= limit || stopped || started.elapsed() >= deadline { break; }
    }
    drop(stream);

    let samples = samples.lock().map(|buffer| buffer.clone()).unwrap_or_default();
    let peak = samples.iter().fold(0f32, |peak, sample| peak.max(sample.abs()));
    if samples.len() < sample_rate as usize || peak < 0.002 {
        return Err("No se oye nada en el sistema. Pon la canción a sonar (con volumen) y vuelve a pulsar.".into());
    }
    // Normaliza el volumen para que Shazam lo reconozca aunque suene bajito.
    let gain = (0.9 / peak).min(20.0);
    let samples: Vec<f32> = samples.iter().map(|sample| sample * gain).collect();
    Ok(wav_bytes(&samples, sample_rate))
}

#[cfg(not(windows))]
fn capture(_seconds: u32) -> Result<Vec<u8>, String> {
    Err("Escuchar el audio del sistema solo está disponible en Windows.".into())
}

/// Graba `seconds` segundos del audio del sistema y devuelve un WAV en base64.
#[tauri::command]
pub async fn record_system_audio(seconds: u32) -> Result<String, String> {
    if RECORDING.swap(true, Ordering::SeqCst) {
        return Err("Ya se está escuchando el audio del sistema.".into());
    }
    STOP.store(false, Ordering::SeqCst);
    let seconds = seconds.clamp(3, 20);
    let result = tauri::async_runtime::spawn_blocking(move || capture(seconds))
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result);
    RECORDING.store(false, Ordering::SeqCst);
    result.map(|bytes| base64_encode(&bytes))
}

/// Termina la escucha antes de tiempo (se reconoce lo grabado hasta ahora).
#[tauri::command]
pub fn stop_system_audio() {
    STOP.store(true, Ordering::SeqCst);
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}
