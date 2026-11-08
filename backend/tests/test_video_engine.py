from pathlib import Path

from backend.src import video_engine


class _FinishedProcess:
    def __init__(self, command, commands):
        self.command = command
        self.returncode = 0
        commands.append(command)

    def poll(self):
        return self.returncode

    def wait(self, timeout=None):
        return self.returncode

    def communicate(self):
        return "", ""

    def terminate(self):
        self.returncode = -15

    def kill(self):
        self.returncode = -9


def _media(tmp_path, *names):
    paths = []
    for name in names:
        path = tmp_path / name
        path.write_bytes(b"test")
        paths.append(str(path))
    return paths


def test_transition_engine_accepts_voiceovers_and_video_clips(tmp_path, monkeypatch):
    slide1, slide2, voice, intro, outro = _media(
        tmp_path, "slide (1).png", "slide (2).png", "voice.wav", "intro.mp4", "outro.mp4"
    )
    commands = []
    monkeypatch.setattr(video_engine.shutil, "which", lambda _name: "/usr/bin/tool")
    monkeypatch.setattr(
        video_engine.subprocess,
        "Popen",
        lambda command, **_kwargs: _FinishedProcess(command, commands),
    )
    studio = video_engine.VideoStudio(use_powerpoint=False)
    monkeypatch.setattr(
        studio,
        "_ffprobe_duration",
        lambda path: 2.0 if path == voice else 3.0,
    )
    monkeypatch.setattr(studio, "_ffprobe_has_audio", lambda path: path in {intro, outro})

    result = studio.build_video(
        {
            "image_files": [slide1, slide2],
            "voiceover_files": [voice, None],
            "intro_video_path": intro,
            "outro_video_path": outro,
            "output_video_path": str(tmp_path / "result.mp4"),
            "resolution": (3840, 2160),
            "fps": 30,
            "slide_duration": 5,
            "transition_type": "fade",
            "transition_duration": 0.5,
        }
    )

    assert result["engine"] == "ffmpeg-transitions"
    assert len(commands) == 1
    command_text = " ".join(commands[0])
    assert "xfade=transition=fade" in command_text
    assert "[0:a]" in command_text  # intro clip audio
    assert "[4:a]" in command_text  # per-slide voiceover input
    assert "adelay=2500:all=1" in command_text
    assert intro in commands[0]
    assert outro in commands[0]


def test_static_engine_keeps_vfr_and_copies_video_for_audio_only(tmp_path, monkeypatch):
    slide1, slide2, voice, intro, music = _media(
        tmp_path, "slide (1).png", "slide (2).png", "voice.wav", "intro.mp4", "music.mp3"
    )
    commands = []
    monkeypatch.setattr(video_engine.shutil, "which", lambda _name: "/usr/bin/tool")
    monkeypatch.setattr(
        video_engine.subprocess,
        "Popen",
        lambda command, **_kwargs: _FinishedProcess(command, commands),
    )
    studio = video_engine.VideoStudio(use_powerpoint=False)
    monkeypatch.setattr(studio, "_ffprobe_duration", lambda path: 2.0 if path == voice else 3.0)
    monkeypatch.setattr(studio, "_ffprobe_has_audio", lambda path: path == intro)

    result = studio.build_video(
        {
            "image_files": [slide1, slide2],
            "voiceover_files": [voice, None],
            "intro_video_path": intro,
            "background_music": music,
            "output_video_path": str(tmp_path / "result.mp4"),
            "resolution": (3840, 2160),
            "fps": 30,
            "slide_duration": 5,
            "transition_type": "none",
        }
    )

    assert result["engine"] == "ffmpeg"
    slide_command = next(command for command in commands if ".slides.ffconcat" in " ".join(command))
    assert "-fps_mode" in slide_command
    assert slide_command[slide_command.index("-fps_mode") + 1] == "vfr"

    final_command = commands[-1]
    assert final_command[final_command.index("-c:v") + 1] == "copy"
    final_text = " ".join(final_command)
    assert "adelay=3000:all=1" in final_text
    assert "volume=0.1" in final_text


def test_single_slide_ignores_transition_and_uses_static_ffmpeg(tmp_path, monkeypatch):
    (slide,) = _media(tmp_path, "slide (1).png")
    commands = []
    monkeypatch.setattr(video_engine.shutil, "which", lambda _name: "/usr/bin/tool")
    monkeypatch.setattr(
        video_engine.subprocess,
        "Popen",
        lambda command, **_kwargs: _FinishedProcess(command, commands),
    )

    result = video_engine.VideoStudio(use_powerpoint=False).build_video(
        {
            "image_files": [slide],
            "output_video_path": str(tmp_path / "result.mp4"),
            "transition_type": "fade",
            "transition_duration": 0.5,
        }
    )

    assert result["engine"] == "ffmpeg"
    assert all("xfade=" not in " ".join(command) for command in commands)

