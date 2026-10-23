package com.lazyportal.juet.officialportal;

import android.content.Context;
import android.net.http.X509TrustManagerExtensions;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.KeyStore;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/** JUET currently omits its GoDaddy G2 intermediate. Supply that missing chain
 * link as an untrusted intermediate, then ask Android to validate against its
 * normal roots. This does NOT install a trust anchor or bypass TLS/hostname
 * checks. The per-connection socket factory applies only to the pinned host. */
public final class PortalTls implements PortalTransport.Connections {
    interface ServerTrust { void check(X509Certificate[] chain, String authType) throws CertificateException; }
    private final String host;
    private final SSLSocketFactory sockets;

    public PortalTls(Context context, PortalPolicy policy) throws Exception {
        host = new URL(policy.upstream).getHost();
        X509Certificate intermediate;
        try (InputStream input = context.getAssets().open("official-portal-intermediate.pem")) {
            intermediate = (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(input);
        }
        TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        factory.init((KeyStore) null);
        X509TrustManager system = null;
        for (TrustManager manager : factory.getTrustManagers()) if (manager instanceof X509TrustManager) system = (X509TrustManager) manager;
        if (system == null) throw new CertificateException("System certificate validation unavailable");
        X509TrustManagerExtensions platform = new X509TrustManagerExtensions(system);
        X509TrustManager supplemented = supplement(system, intermediate, (chain, auth) -> platform.checkServerTrusted(chain, auth, host));
        SSLContext tls = SSLContext.getInstance("TLS");
        tls.init(null, new TrustManager[] { supplemented }, null); sockets = tls.getSocketFactory();
    }

    static X509TrustManager supplement(X509TrustManager system, X509Certificate intermediate, ServerTrust trusted) {
        return new X509TrustManager() {
            @Override public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                try { trusted.check(chain, authType); }
                catch (CertificateException original) {
                    if (chain == null || chain.length == 0 || !chain[chain.length - 1].getIssuerX500Principal().equals(intermediate.getSubjectX500Principal())) throw original;
                    intermediate.checkValidity();
                    X509Certificate[] completed = Arrays.copyOf(chain, chain.length + 1);
                    completed[chain.length] = intermediate;
                    // Still rejects bad signatures, expired certificates,
                    // untrusted roots and the wrong hostname via Android.
                    trusted.check(completed, authType);
                }
            }
            @Override public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException { system.checkClientTrusted(chain, authType); }
            @Override public X509Certificate[] getAcceptedIssuers() { return system.getAcceptedIssuers(); }
        };
    }

    @Override public HttpURLConnection open(URL url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        if (connection instanceof HttpsURLConnection && host.equals(url.getHost()) && (url.getPort() == -1 || url.getPort() == 443)) {
            ((HttpsURLConnection) connection).setSSLSocketFactory(sockets);
            // The platform hostname verifier is intentionally left unchanged.
        }
        return connection;
    }
}
