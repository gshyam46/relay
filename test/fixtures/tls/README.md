# Synthetic TLS fixtures

This certificate and private key are public test-only material generated locally for loopback TLS regression tests. They must never be used for a deployment, trusted outside a test connection, or confused with application secrets. The certificate covers localhost and loopback IPs, is a self-signed test CA, and has a long validity period to avoid time-dependent CI failures. Tests exercise actual Node TLS acceptance and refusal; they do not prove a real PostgreSQL or managed-provider connection.
