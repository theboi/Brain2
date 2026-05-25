"""Domain errors. API layer maps these to HTTP status codes (P12)."""


class Brain2Error(Exception):
    """Base for all Brain2 domain errors."""


class PermissionDenied(Brain2Error):
    """authorize() rejected the action (-> 403)."""


class NotFound(Brain2Error):
    """A scoped entity does not exist for this tenant (-> 404)."""


class Conflict(Brain2Error):
    """Optimistic-concurrency / uniqueness conflict (-> 409)."""


class MigrationError(Brain2Error):
    """Schema migration failure or code/schema version skew (-> boot refusal)."""


class RateLimitExceeded(Brain2Error):
    """Request rejected due to rate limit or backlog ceiling."""


class LLMError(Brain2Error):
    """LLM provider error (5xx, circuit open, timeout, etc.) (-> 502 or 503)."""


class PageTooLarge(Brain2Error):
    """Wiki page content exceeds the byte ceiling (-> 413)."""


class QueryNotAllowed(Brain2Error):
    """Query was rejected (write attempt, parse violation, etc.) (-> 400)."""

class AggregateOverUnboundedResult(Brain2Error):
    """Aggregate computed over a truncated result set — answer would be wrong (-> 400)."""

class SSRFBlocked(Brain2Error):
    """URL targets a private/link-local/loopback address — request refused (-> 400)."""
