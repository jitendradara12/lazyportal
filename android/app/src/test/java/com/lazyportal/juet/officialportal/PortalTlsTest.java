package com.lazyportal.juet.officialportal;

import static org.junit.Assert.*;

import java.io.FileInputStream;
import java.io.InputStream;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.List;
import javax.net.ssl.X509TrustManager;
import org.junit.Before;
import org.junit.Test;

public class PortalTlsTest {
    private X509Certificate intermediate, leaf;
    private final X509Certificate[] roots = new X509Certificate[0];
    private final X509TrustManager system = new X509TrustManager() {
        @Override public void checkServerTrusted(X509Certificate[] chain, String auth) throws CertificateException { throw new CertificateException("Untrusted"); }
        @Override public void checkClientTrusted(X509Certificate[] chain, String auth) throws CertificateException { throw new CertificateException("Client rejected"); }
        @Override public X509Certificate[] getAcceptedIssuers() { return roots; }
    };
    @Before public void setup() throws Exception {
        CertificateFactory certificates = CertificateFactory.getInstance("X.509");
        try (InputStream input = new FileInputStream("src/main/assets/official-portal-intermediate.pem")) {
            intermediate = (X509Certificate) certificates.generateCertificate(input);
        }
        // Public leaf captured 2026-10-24. No private key or student data. These
        // tests use an injected validator, so leaf expiry is deliberately tested
        // as a rejection path rather than making a network/date-dependent test.
        try (InputStream input = getClass().getResourceAsStream("/portal-leaf-test.pem")) {
            leaf = (X509Certificate) certificates.generateCertificate(input);
        }
    }
    @Test public void missingIntermediateIsSuppliedToTheExistingValidatorWithoutAddingRoots() throws Exception {
        List<X509Certificate[]> attempts = new ArrayList<>();
        X509TrustManager trust = PortalTls.supplement(system, intermediate, (chain, auth) -> {
            attempts.add(chain);
            if (chain.length == 1) throw new CertificateException("Missing intermediate");
        });
        trust.checkServerTrusted(new X509Certificate[] { leaf }, "RSA");
        assertEquals(2, attempts.size());
        assertArrayEquals(new X509Certificate[] { leaf, intermediate }, attempts.get(1));
        assertSame(roots, trust.getAcceptedIssuers());
    }
    @Test public void aCompleteChainIsValidatedOnce() throws Exception {
        final int[] attempts = { 0 };
        X509TrustManager trust = PortalTls.supplement(system, intermediate, (chain, auth) -> attempts[0]++);
        trust.checkServerTrusted(new X509Certificate[] { leaf, intermediate }, "RSA");
        assertEquals(1, attempts[0]);
    }
    @Test public void validationFailuresStillRejectAndUnrelatedIssuersDoNotRetry() {
        final int[] attempts = { 0 };
        X509TrustManager trust = PortalTls.supplement(system, intermediate, (chain, auth) -> {
            attempts[0]++; throw new CertificateException("Bad signature / expired / wrong hostname");
        });
        assertThrows(CertificateException.class, () -> trust.checkServerTrusted(new X509Certificate[] { leaf }, "RSA"));
        assertEquals(2, attempts[0]);
        attempts[0] = 0;
        assertThrows(CertificateException.class, () -> trust.checkServerTrusted(new X509Certificate[] { intermediate }, "RSA"));
        assertEquals(1, attempts[0]);
        assertThrows(CertificateException.class, () -> trust.checkClientTrusted(new X509Certificate[] { leaf }, "RSA"));
    }
}
