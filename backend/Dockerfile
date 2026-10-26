# syntax=docker/dockerfile:1

# Build stage: compile the static Go binary.
FROM golang:1.24-alpine AS builder

WORKDIR /src

# Cache module downloads separately from source changes.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# Runtime stage: tiny image with CA certificates for outbound HTTPS scrapers.
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S naapi \
    && adduser -S -G naapi naapi

COPY --from=builder /out/server /usr/local/bin/server

ENV PORT=8080 \
    TZ=Asia/Jakarta

USER naapi
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1

ENTRYPOINT ["server"]
