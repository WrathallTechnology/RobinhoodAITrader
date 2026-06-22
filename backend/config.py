from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Safety
    trading_enabled: bool = False

    # App
    secret_key: str = "change-me-in-production"

    # Robinhood OAuth callback base URL
    # Set to your public URL when deployed (e.g. https://your-domain.com)
    callback_base_url: str = "http://localhost"

    @property
    def robinhood_redirect_uri(self) -> str:
        return f"{self.callback_base_url.rstrip('/')}/auth/robinhood/callback"

    # Risk defaults (overridable per strategy)
    max_position_pct: float = 0.05   # 5% of portfolio per position
    max_daily_loss_pct: float = 0.02  # halt if daily P&L drops 2%

    # Paths — default to sibling dirs of this file so non-Docker installs work.
    # In Docker, /app is the working directory so __file__ resolves to /app/config.py
    # and these still evaluate to /app/data and /app/strategies.
    data_dir: Path = Path(__file__).parent / "data"
    strategies_dir: Path = Path(__file__).parent / "strategies"

    @property
    def db_url(self) -> str:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite+aiosqlite:///{self.data_dir}/trader.db"


settings = Settings()
