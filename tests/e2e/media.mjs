import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Genera (una vez) un video HLS real de 12 s con 2 calidades usando ffmpeg, con la misma estructura que
 * entrega Bunny: <guid>/playlist.m3u8 (maestro) -> <n>/video.m3u8 -> segmentos con ruta relativa.
 */
export function ensureMedia(guid) {
  const dir = join(tmpdir(), 'yp-e2e-media', guid);
  if (existsSync(join(dir, 'playlist.m3u8'))) return dir;
  mkdirSync(dir, { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
    '-filter_complex', '[0:v]split=2[a][b];[a]scale=320:180[v0];[b]scale=640:360[v1]',
    '-map', '[v0]', '-map', '[v1]', '-map', '1:a', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-g', '50', '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '64k',
    '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod',
    '-var_stream_map', 'v:0,a:0 v:1,a:1', '-master_pl_name', 'playlist.m3u8',
    '-hls_segment_filename', join(dir, '%v_seg%03d.ts'), join(dir, '%v_video.m3u8')], { stdio: 'inherit' });
  return dir;
}
