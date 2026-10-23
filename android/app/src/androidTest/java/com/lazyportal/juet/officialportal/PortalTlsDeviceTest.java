package com.lazyportal.juet.officialportal;

import static org.junit.Assert.*;

import android.net.http.X509TrustManagerExtensions;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.InputStream;
import java.security.KeyStore;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.concurrent.atomic.AtomicInteger;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Actual Android certificate-path validation, offline. The public fixtures
 * contain no private keys and their test root is never in production trust. */
@RunWith(AndroidJUnit4.class)
public class PortalTlsDeviceTest {
    private static X509Certificate certificate(String name) throws Exception {
        try (InputStream input = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("tls/" + name + ".pem")) {
            return (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(input);
        }
    }
    private static X509TrustManager trustManager(KeyStore roots) throws Exception {
        TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        factory.init(roots);
        for (TrustManager manager : factory.getTrustManagers()) if (manager instanceof X509TrustManager) return (X509TrustManager) manager;
        throw new AssertionError("Android trust manager unavailable");
    }
    @Test public void supplementalIntermediateRepairsARealAndroidCertificatePath() throws Exception {
        KeyStore roots = KeyStore.getInstance(KeyStore.getDefaultType()); roots.load(null);
        roots.setCertificateEntry("instrumentation-only", certificate("root"));
        X509TrustManager system = trustManager(roots);
        X509TrustManagerExtensions platform = new X509TrustManagerExtensions(system);
        X509Certificate leaf = certificate("leaf"), intermediate = certificate("intermediate");
        AtomicInteger attempts = new AtomicInteger();
        X509TrustManager repaired = PortalTls.supplement(system, intermediate, (chain, auth) -> {
            attempts.incrementAndGet();
            platform.checkServerTrusted(chain, auth, "storage-test.lazyportal.invalid");
        });
        repaired.checkServerTrusted(new X509Certificate[] { leaf }, "RSA");
        assertEquals(2, attempts.get());
        assertArrayEquals(system.getAcceptedIssuers(), repaired.getAcceptedIssuers());
    }
    @Test public void supplementationCannotMakeAnUntrustedRootTrusted() throws Exception {
        X509TrustManager system = trustManager(null); // Real Android roots do not include the test CA.
        X509TrustManagerExtensions platform = new X509TrustManagerExtensions(system);
        X509TrustManager repaired = PortalTls.supplement(system, certificate("intermediate"),
            (chain, auth) -> platform.checkServerTrusted(chain, auth, "storage-test.lazyportal.invalid"));
        X509Certificate leaf = certificate("leaf");
        assertThrows(CertificateException.class, () -> repaired.checkServerTrusted(new X509Certificate[] { leaf }, "RSA"));
    }
}
