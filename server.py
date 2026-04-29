# server.py
import os, uuid, subprocess, threading
from flask import Flask, request, jsonify, send_file, abort
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

JOBS = {}          # job_id -> {'status', 'file', 'error'}
OUTPUT_DIR = "/tmp/clipcut"
os.makedirs(OUTPUT_DIR, exist_ok=True)

def run_job(job_id, video_url, ss, duration, fmt, quality, filename):
    out_path = os.path.join(OUTPUT_DIR, filename)
    JOBS[job_id] = {'status': 'processing', 'file': out_path, 'error': None}
    try:
        trim = f"-ss {ss} -t {duration}"
        if fmt == "mp3":
            cmd = [
                "yt-dlp", "-x", "--audio-format", "mp3",
                "--postprocessor-args", f"ffmpeg:{trim}",
                "-o", out_path, video_url
            ]
        else:
            q = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]" \
                if quality == "best" else \
                f"bestvideo[height<={quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<={quality}][ext=mp4]"
            cmd = [
                "yt-dlp", "-f", q,
                "--merge-output-format", "mp4",
                "--postprocessor-args", f"ffmpeg:{trim}",
                "-o", out_path, video_url
            ]
        subprocess.run(cmd, check=True, capture_output=True)
        JOBS[job_id]['status'] = 'done'
    except subprocess.CalledProcessError as e:
        JOBS[job_id]['status'] = 'error'
        JOBS[job_id]['error'] = e.stderr.decode()

@app.route("/clip", methods=["POST"])
def clip():
    d = request.json
    vid   = d.get("videoId", "")
    ss    = int(d.get("start", 0))
    dur   = int(d.get("duration", 30))
    fmt   = d.get("format", "mp4")
    qual  = d.get("quality", "best")
    name  = d.get("filename", "clip").replace(" ", "_")
    ext   = "mp3" if fmt == "mp3" else "mp4"
    filename = f"{uuid.uuid4().hex}_{name}.{ext}"
    url   = f"https://www.youtube.com/watch?v={vid}"
    job_id = uuid.uuid4().hex
    t = threading.Thread(target=run_job, args=(job_id, url, ss, dur, fmt, qual, filename))
    t.start()
    return jsonify({"job_id": job_id})

@app.route("/status/<job_id>")
def status(job_id):
    job = JOBS.get(job_id)
    if not job:
        abort(404)
    base_url = request.host_url.rstrip("/")
    if job['status'] == 'done':
        return jsonify({"status": "done", "download_url": f"{base_url}/download/{job_id}"})
    return jsonify({"status": job['status'], "error": job.get('error')})

@app.route("/download/<job_id>")
def download(job_id):
    job = JOBS.get(job_id)
    if not job or job['status'] != 'done':
        abort(404)
    return send_file(job['file'], as_attachment=True)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
