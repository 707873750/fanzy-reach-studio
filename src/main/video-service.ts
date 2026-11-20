import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import type { ImageAsset } from "../shared/types";

const exec = promisify(execFile);
const unpack = (file: string) => file.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2");

export async function inspectVideo(file: string): Promise<Pick<ImageAsset, "width" | "height" | "video">> {
  const { stdout } = await exec(unpack(ffprobe.path), ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  const info = JSON.parse(stdout);
  const video = info.streams?.find((stream: any) => stream.codec_type === "video" && !stream.disposition?.attached_pic);
  const audio = info.streams?.find((stream: any) => stream.codec_type === "audio");
  if (!video) throw new Error("文件中没有可读取的视频轨道");
  const [n, d] = String(video.avg_frame_rate || "0/1").split("/").map(Number);
  const duration = Number(info.format?.duration || video.duration);
  const fps = n / d;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fps) || fps <= 0 || !(video.width > 0 && video.height > 0)) throw new Error("视频时长、尺寸或帧率无效");
  const rotation = Number(video.side_data_list?.find((item: any) => item.rotation !== undefined)?.rotation || video.tags?.rotate || 0);
  const rotated = Math.abs(rotation % 180) === 90;
  return { width: rotated ? video.height : video.width, height: rotated ? video.width : video.height,
    video: { duration, fps, codec: video.codec_name, audioCodec: audio?.codec_name, pixelFormat: video.pix_fmt || "" } };
}

export async function makeVideoThumbnail(file: string, destination: string) {
  if (!ffmpegPath) throw new Error("当前系统缺少视频处理工具");
  await exec(unpack(ffmpegPath), ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", file,
    "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=360:360:force_original_aspect_ratio=decrease", destination],
  { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
}
