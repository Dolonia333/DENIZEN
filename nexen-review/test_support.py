"""Lazy isolated test storage without a C: or platform-temp fallback."""
import os
from pathlib import Path
from unittest import SkipTest

from storage_policy import require_output_path


def fixture_root():
    """Create a checked parent only when a test needs a temporary directory."""
    configured = os.environ.get('NEXEN_TEST_ROOT')
    if configured:
        root = require_output_path(configured)
    elif Path('H:/').is_dir():
        root = require_output_path('H:/NEXEN/temp/tests')
    elif Path('F:/').is_dir():
        root = require_output_path('F:/NEXEN_CACHE/test-fixtures')
    else:
        raise SkipTest('These Windows-local tests require H: or F: storage; no other drive is used.')
    root.mkdir(parents=True, exist_ok=True)
    return require_output_path(root)
