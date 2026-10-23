Public certificates for offline Android trust-manager instrumentation tests.
These form an artificial RSA/SHA-256 root → intermediate → server chain for
`storage-test.lazyportal.invalid`. Private keys were discarded after generation.
The root is installed only in an in-memory KeyStore inside the positive test;
it is never added to production trust, app assets, or network configuration.
The negative test verifies that Android's real roots still reject this chain.

These fixtures remain valid through 2044, avoiding dependence on JUET's
short-lived server certificate or an external network connection. They exercise
Android's real path validator; live JUET connectivity and hostname verification
still require validation of the final APK on a device.
