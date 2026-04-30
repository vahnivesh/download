import os
import uuid
from flask import Flask, request, send_file, jsonify
import yt_dlp

app = Flask(__name__)

DOWNLOAD_DIR = "downloads"
os.makedirs(DOWNLOAD_DIR, exist_ok=True)


def download_video(url, filename, format_type, quality):
    out_path = os.path.join(DOWNLOAD_DIR, filename)

    ydl_opts = {
        'outtmpl': out_path,
        'quiet': True,
    }

    if format_type == "mp3":
        ydl_opts.update({
            'format': 'bestaudio',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
            }]
        })
    else:
        if quality == "best":
            fmt = "bestvideo+bestaudio/best"
        else:
            fmt = f"bestvideo[height<={quality}]+bestaudio/best[height<={quality}]"

        ydl_opts.update({
            'format': fmt,
            'merge_output_format': 'mp4'
        })

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])

    return out_path


@app.route("/")
def home():
    return jsonify({"status": "running"})


@app.route("/download", methods=["POST"])
def download():
    data = request.json

    url = data.get("url")
    format_type = data.get("format", "mp4")
    quality = data.get("quality", "best")

    file_id = str(uuid.uuid4())
    filename = f"{file_id}.%(ext)s"

    try:
        path = download_video(url, filename, format_type, quality)

        # find actual file
        files = os.listdir(DOWNLOAD_DIR)
        for f in files:
            if file_id in f:
                return send_file(
                    os.path.join(DOWNLOAD_DIR, f),
                    as_attachment=True
                )

        return jsonify({"error": "File not found"}), 500

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
