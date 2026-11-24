FROM rust:1.88-bookworm AS build
WORKDIR /build
COPY services/api-rust/Cargo.toml services/api-rust/Cargo.lock ./
COPY services/api-rust/src ./src
COPY services/api-rust/migrations ./migrations
COPY services/api-rust/data ./data
RUN cargo build --locked --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /build/target/release/dsa-api /usr/local/bin/dsa-api
# Bound glibc arena retention under concurrent JSON/undo allocation churn.
# These tune allocator retention, not the application payload budget.
ENV MALLOC_ARENA_MAX=2 MALLOC_TRIM_THRESHOLD_=65536 MALLOC_MMAP_THRESHOLD_=65536
ENV API_HOST=0.0.0.0 DSA_DB_PATH=/data/dsa.db LOCAL_LLM_ENABLED=0 LAYA_ENABLED=0
EXPOSE 8787
CMD ["dsa-api"]
