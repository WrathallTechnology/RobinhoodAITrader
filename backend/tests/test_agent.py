"""Tests for agent runner safety guards and strategy loading."""
import pytest
import yaml
from pathlib import Path

from agent.runner import build_system_prompt, ORDER_TOOLS


STRATEGIES_DIR = Path(__file__).parent.parent / "strategies"


def load_strategy(filename: str) -> dict:
    return yaml.safe_load((STRATEGIES_DIR / filename).read_text())


def test_dry_run_prompt_blocks_orders():
    strategy = load_strategy("momentum.yaml")
    prompt = build_system_prompt(strategy, dry_run=True)
    assert "DRY RUN" in prompt
    assert "do NOT call any order-placement tools" in prompt.lower() or "DO NOT call" in prompt


def test_live_prompt_no_dry_run_flag():
    strategy = load_strategy("momentum.yaml")
    prompt = build_system_prompt(strategy, dry_run=False)
    assert "DRY RUN" not in prompt


def test_position_size_in_prompt():
    strategy = load_strategy("momentum.yaml")
    prompt = build_system_prompt(strategy, dry_run=False)
    assert "5.0%" in prompt  # default 5%


def test_custom_position_size_in_prompt():
    strategy = {"name": "Test", "max_position_pct": 0.02, "system_prompt": "test"}
    prompt = build_system_prompt(strategy, dry_run=False)
    assert "2.0%" in prompt


def test_watchlist_included_in_prompt():
    strategy = load_strategy("custom_template.yaml")
    prompt = build_system_prompt(strategy, dry_run=False)
    assert "AAPL" in prompt


def test_all_strategy_yamls_valid():
    for f in STRATEGIES_DIR.glob("*.yaml"):
        data = yaml.safe_load(f.read_text())
        assert "name" in data, f"{f.name} missing 'name'"
        assert "system_prompt" in data, f"{f.name} missing 'system_prompt'"
        assert "schedule" in data, f"{f.name} missing 'schedule'"


def test_order_tools_set_not_empty():
    assert len(ORDER_TOOLS) > 0
    assert "place_order" in ORDER_TOOLS
