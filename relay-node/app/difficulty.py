"""Simple difficulty controller.

Targets a median solve time by nudging `current` toward `target_ms` using
an EMA of recent block times. Bounded per-step to avoid wild swings.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field


@dataclass
class DifficultyController:
    target_ms: int = 30_000
    current: int = 1_000_000
    min_difficulty: int = 10_000
    max_difficulty: int = 1_000_000_000
    max_step_ratio: float = 1.25  # cap ±25% per adjustment
    window: int = 16
    _samples: deque[int] = field(default_factory=lambda: deque(maxlen=16))

    def record(self, elapsed_ms: int) -> None:
        self._samples.append(elapsed_ms)

    def next_difficulty(self) -> int:
        if not self._samples:
            return self.current
        ema = sum(self._samples) / len(self._samples)
        if ema <= 0:
            return self.current
        ratio = self.target_ms / ema
        ratio = max(1 / self.max_step_ratio, min(self.max_step_ratio, ratio))
        self.current = int(max(self.min_difficulty, min(self.max_difficulty, self.current * ratio)))
        return self.current
