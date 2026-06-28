.PHONY: dev
dev:
	@echo "Starting brain2 API + Worker..."
	@trap 'kill %1 %2' INT TERM; \
	../.venv/bin/brain2-api & \
	../.venv/bin/brain2-worker & \
	wait
