# zarklink Makefile
# Convenience commands for development

.PHONY: help build test clean install deploy demo demo-quick demo-detailed

help:
	@echo "zarklink Bridge - Development Commands"
	@echo ""
	@echo "Demo Commands:"
	@echo "  make demo          - Run quick demo (minimal)"
	@echo "  make demo-detailed - Run detailed demo (full walkthrough)"
	@echo ""
	@echo "Build Commands:"
	@echo "  make build         - Build Cairo contracts"
	@echo "  make test          - Run Cairo tests"
	@echo "  make clean         - Clean build artifacts"
	@echo ""
	@echo "Setup Commands:"
	@echo "  make install       - Install all dependencies"
	@echo "  make install-cli   - Install CLI dependencies"
	@echo "  make install-relay - Install relay service dependencies"
	@echo ""
	@echo "Deployment:"
	@echo "  make deploy-sepolia - Deploy to Starknet Sepolia"
	@echo ""
	@echo "Development:"
	@echo "  make relay-start   - Start relay service"
	@echo "  make cli-help      - Show CLI help"
	@echo ""
	@echo "Circom:"
	@echo "  make circom-compile - Compile all circom circuits"

# =============================================================================
# Demo Commands
# =============================================================================

demo: demo-quick

demo-quick:
	@./demo/demo_quick.sh

demo-detailed:
	@./demo/demo_detailed.sh

# =============================================================================
# Cairo Commands
# =============================================================================

build:
	cd cairo && scarb build

test:
	cd cairo && scarb test

clean:
	cd cairo && scarb clean
	rm -rf circom/*.r1cs circom/*.wasm circom/*.sym

fmt:
	cd cairo && scarb fmt

# =============================================================================
# Installation
# =============================================================================

install: install-cli install-relay
	@echo "All dependencies installed"

install-cli:
	cd cli && npm install

install-relay:
	cd relay-service && npm install

# =============================================================================
# Deployment
# =============================================================================

deploy-sepolia:
	cd cairo && ./scripts/deploy.sh sepolia

deploy-mainnet:
	cd cairo && ./scripts/deploy.sh mainnet

# =============================================================================
# Development
# =============================================================================

relay-start:
	cd relay-service && npm start

cli-help:
	cd cli && node src/index.js --help

status:
	cd cli && node src/index.js status health

# =============================================================================
# Circom
# =============================================================================

circom-compile:
	@echo "Compiling circom circuits..."
	cd circom && \
	for circuit in circuits/*.circom; do \
		circom $$circuit --r1cs --wasm --sym -o .; \
	done

circom-test:
	cd circom && npm test

# =============================================================================
# Integration Tests
# =============================================================================

integration-test:
	./scripts/integration_test.sh

# =============================================================================
# Docker (optional)
# =============================================================================

docker-build:
	docker build -t zclaim-relay -f relay-service/Dockerfile .

docker-run:
	docker run --env-file relay-service/.env zclaim-relay
