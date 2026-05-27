class ConfigError(Exception):
    """Missing/invalid bot configuration."""


class ApiError(Exception):
    """A Brain2 REST call returned a 4xx/5xx."""
    def __init__(self, status: int, detail: str):
        super().__init__(f"{status}: {detail}")
        self.status = status
        self.detail = detail


class NeedRelink(Exception):
    """The cached session is unusable (token + refresh both failed)."""
