"""Validate Windows NEXEN output locations before creating or saving files.

This guards NEXEN-owned paths; it is not an OS sandbox for third-party plugins.
"""
import os
from pathlib import Path, PureWindowsPath
import stat

ALLOWED_DRIVES = frozenset({'H:', 'F:'})


class StoragePolicyError(ValueError):
    """A requested write would violate the owner's H/F storage constraint."""


def require_output_path(value, *, within=None):
    """Reject off-drive, ambiguous or redirected output paths before any write."""
    raw = os.fspath(value)
    if not isinstance(raw, str) or not raw or '\x00' in raw:
        raise StoragePolicyError('Output needs an absolute H: or F: path.')
    lexical = PureWindowsPath(raw)
    if not lexical.is_absolute() or lexical.drive.upper() not in ALLOWED_DRIVES:
        raise StoragePolicyError('NEXEN saves only to H: or F:. No fallback drive is permitted.')
    for part in lexical.parts[1:]:
        reserved = part.split('.')[0].upper()
        if (part in {'.', '..'} or part.endswith(('.', ' ')) or
            any(character in part for character in '<>:"|?*') or
            any(ord(character) < 32 for character in part) or
            reserved in {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}):
            raise StoragePolicyError('Output path contains an unsupported Windows component.')
    path = Path(raw)
    for candidate in (path, *path.parents):
        try:
            info = candidate.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise StoragePolicyError('NEXEN output cannot pass through a link or reparse point.')
    resolved = path.resolve(strict=False)
    if resolved.drive.upper() not in ALLOWED_DRIVES:
        raise StoragePolicyError('Resolved output must remain on H: or F:.')
    if within is not None:
        root = require_output_path(within)
        if not resolved.is_relative_to(root):
            raise StoragePolicyError('Output is outside this tool\'s assigned folder.')
    return resolved


def tool_environment(root, environ=None):
    """Keep the child tool's configurable profile and cache paths on H/F."""
    root = require_output_path(root)
    env = dict(os.environ if environ is None else environ)
    folders = {
        'TEMP': 'temp', 'TMP': 'temp', 'TMPDIR': 'temp',
        'USERPROFILE': 'profile', 'HOME': 'profile',
        'APPDATA': 'profile/roaming', 'LOCALAPPDATA': 'profile/local',
        'XDG_CACHE_HOME': 'cache', 'XDG_CONFIG_HOME': 'config', 'XDG_DATA_HOME': 'data',
        'PIP_CACHE_DIR': 'cache/pip', 'UV_CACHE_DIR': 'cache/uv',
        'HF_HOME': 'cache/huggingface', 'TORCH_HOME': 'cache/torch',
        'npm_config_cache': 'cache/npm',
    }
    for name, relative in folders.items():
        destination = require_output_path(root / relative, within=root)
        destination.mkdir(parents=True, exist_ok=True)
        env[name] = str(destination)
    profile = require_output_path(env['USERPROFILE'], within=root)
    env['HOMEDRIVE'], env['HOMEPATH'] = profile.drive, str(profile)[len(profile.drive):]
    env['PYTHONDONTWRITEBYTECODE'] = '1'
    return env
