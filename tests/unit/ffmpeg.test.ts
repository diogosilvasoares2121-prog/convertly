import { describe, expect, it } from 'vitest';
import { compressVideo, convertAudio, convertVideo, muteVideo, probeArgs, resizeVideo, rotateVideo, trimMedia, videoToGif } from '../../src/engines/ffmpeg/commands';
import { parseProbe, videoDecodable, displaySize, type MediaInfo } from '../../src/engines/ffmpeg/probe';
import { ProgressTracker, errorFromLogs, parseClock } from '../../src/engines/ffmpeg/logs';

const info = (over: Partial<MediaInfo> = {}): MediaInfo => ({
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  duration: 10,
  bitrate: 1_000_000,
  video: { codec: 'h264', width: 1920, height: 1080, fps: 30, rotation: 0, bitrate: 900_000 },
  audio: { codec: 'aac', sampleRate: 44100, channels: 2, bitrate: 128_000 },
  audioStreams: 1,
  videoStreams: 1,
  ...over,
});

describe('FFmpeg command builders', () => {
  it('remuxes H.264/AAC MOV → MP4 without re-encoding in fast mode', () => {
    const c = convertVideo({ input: 'input.mov', info: info(), target: 'mp4', quality: 'balanced', allowCopy: true, baseName: 'output' });
    expect(c.streamCopy).toBe(true);
    expect(c.args).toEqual(expect.arrayContaining(['-c', 'copy', '-movflags', '+faststart']));
    expect(c.output).toBe('output.mp4');
  });

  it('re-encodes when codecs are not compatible', () => {
    const c = convertVideo({ input: 'input.avi', info: info({ video: { codec: 'mpeg4', width: 640, height: 480, fps: 25, rotation: 0, bitrate: null } }), target: 'mp4', quality: 'high', allowCopy: true, baseName: 'output' });
    expect(c.streamCopy).toBe(false);
    expect(c.args).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac']));
    const webm = convertVideo({ input: 'input.mp4', info: info(), target: 'webm', quality: 'small', allowCopy: true, baseName: 'output' });
    expect(webm.args).toEqual(expect.arrayContaining(['-c:v', 'libvpx', '-c:a', 'libopus']));
  });

  it('extracts audio as MP3 with the chosen bitrate', () => {
    const c = convertAudio({ input: 'input.mp4', info: info(), target: 'mp3', bitrateKbps: 192, allowCopy: true, baseName: 'output' });
    expect(c.args).toEqual(expect.arrayContaining(['-vn', '-c:a', 'libmp3lame', '-b:a', '192k']));
    expect(c.output).toBe('output.mp3');
  });

  it('copies AAC into M4A when possible', () => {
    const c = convertAudio({ input: 'input.mp4', info: info(), target: 'm4a', bitrateKbps: 192, allowCopy: true, baseName: 'output' });
    expect(c.streamCopy).toBe(true);
  });

  it('builds fast and precise trims with the right duration', () => {
    const fast = trimMedia({ input: 'input.mp4', info: info(), format: 'mp4', start: 2, end: 5.5, precise: false, baseName: 'output', kind: 'video' });
    expect(fast.args.slice(0, 2)).toEqual(['-ss', '2.000']);
    expect(fast.args).toEqual(expect.arrayContaining(['-t', '3.500', '-c', 'copy']));
    expect(fast.duration).toBe(3.5);
    const precise = trimMedia({ input: 'input.mp4', info: info(), format: 'mp4', start: 2, end: 5.5, precise: true, baseName: 'output', kind: 'video' });
    expect(precise.args).toContain('libx264');
    const audio = trimMedia({ input: 'input.wav', info: info({ video: null }), format: 'wav', start: 0, end: 1, precise: false, baseName: 'output', kind: 'audio' });
    expect(audio.args).toEqual(expect.arrayContaining(['-c:a', 'pcm_s16le']));
  });

  it('resizes, mutes, rotates, compresses and makes GIFs', () => {
    expect(resizeVideo({ input: 'i.mp4', info: info(), format: 'mp4', height: 720, baseName: 'o' }).args.join(' ')).toContain('scale=-2:720');
    expect(muteVideo({ input: 'i.mp4', info: info(), format: 'mp4', baseName: 'o' }).args).toEqual(expect.arrayContaining(['-an', '-c:v', 'copy']));
    expect(rotateVideo({ input: 'i.mp4', info: info(), format: 'mp4', mode: 'cw', baseName: 'o' }).args.join(' ')).toContain('transpose=1');
    const comp = compressVideo({ input: 'i.mp4', info: info(), crf: 28, maxHeight: 720, videoBitrateKbps: null, audioBitrateKbps: 96, baseName: 'o' });
    expect(comp.args.join(' ')).toContain('scale=-2:720');
    expect(comp.args).toEqual(expect.arrayContaining(['-crf', '28', '-b:a', '96k']));
    const gif = videoToGif({ input: 'i.mp4', start: 1, end: 4, fps: 12, width: 480, loop: true, baseName: 'o', sourceWidth: 1920 });
    expect(gif.args.join(' ')).toContain('palettegen');
    expect(gif.duration).toBe(3);
    expect(probeArgs('input.mp4', 'p.json')).toEqual(['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-o', 'p.json', '/input/input.mp4']);
  });
});

describe('ffprobe parsing', () => {
  it('parses streams, ignores cover art and handles rotation', () => {
    const json = JSON.stringify({
      format: { format_name: 'mov,mp4', duration: '12.5', bit_rate: '800000' },
      streams: [
        { codec_type: 'video', codec_name: 'hevc', width: 1920, height: 1080, avg_frame_rate: '30000/1001', side_data_list: [{ rotation: -90 }] },
        { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
        { codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
      ],
    });
    const i = parseProbe(json);
    expect(i.duration).toBe(12.5);
    expect(i.video?.codec).toBe('hevc');
    expect(i.video?.rotation).toBe(270);
    expect(i.videoStreams).toBe(1);
    expect(displaySize(i)).toEqual({ width: 1080, height: 1920 });
    expect(videoDecodable(i)).toBe(true);
    expect(videoDecodable(info({ video: { codec: 'av1', width: 1, height: 1, fps: null, rotation: 0, bitrate: null } }))).toBe(false);
  });
});

describe('FFmpeg logs', () => {
  it('computes real progress from time= lines', () => {
    const t = new ProgressTracker(null);
    expect(t.update('  Duration: 00:00:10.00, start: 0.000000, bitrate: 128 kb/s')).toBeUndefined();
    expect(t.update('frame=  100 fps= 25 q=28.0 size= 256kB time=00:00:05.00 bitrate=419.4kbits/s')).toBeCloseTo(0.5);
    expect(parseClock('01:02:03.5')).toBe(3723.5);
  });
  it('maps errors to meaningful codes', () => {
    expect(errorFromLogs(['Stream map \'0:a:0\' matches no streams.'], 'audio').code).toBe('no-audio-track');
    expect(errorFromLogs(['input.mp4: Invalid data found when processing input']).code).toBe('corrupted-file');
    expect(errorFromLogs(['Unknown encoder \'libfoo\'']).code).toBe('unsupported-codec');
    expect(errorFromLogs(['Cannot allocate memory']).code).toBe('out-of-memory');
    expect(errorFromLogs(['something odd']).code).toBe('conversion-failed');
  });
});
