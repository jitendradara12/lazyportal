package com.lazyportal.juet.officialportal;

import static org.junit.Assert.*;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;

/** Runs in CI's testDebugUnitTest without a device or network. */
public class PortalPolicyTest {
    private PortalPolicy policy;

    @Before public void loadPolicy() throws Exception {
        String json = new String(Files.readAllBytes(new File("src/main/assets/official-portal-policy.json").toPath()), StandardCharsets.UTF_8);
        policy = new PortalPolicy(new JSONObject(json));
    }

    @Test public void exactReviewedReadEndpointsOnly() throws Exception {
        assertTrue(policy.allowsApi("POST", "/clxuser/getmenulist"));
        assertTrue(policy.allowsApi("GET", "/token/productversion"));
        assertEquals(policy.upstream + "/StudentPortalAPI/clxuser/getmenulist", policy.apiUrl("POST", "/clxuser/getmenulist").toString());
        for (String path : new String[] {
            "/onlinefeepayment/paynow", "/studentbankdetails/savestudentbankinfo", "/clxuser/changepassword",
            "/token/generatewebtoken", "/future/getSomething", "/clxuser/getmenulist/", "/CLXUSER/getmenulist",
            "/clxuser/getmenulist?method=save", "/clxuser/getmenulist#fragment", "/clxuser/../getmenulist",
            "/clxuser%2fgetmenulist", "https://evil.test/clxuser/getmenulist",
        }) assertFalse(path, policy.allowsApi("POST", path));
        for (String method : new String[] { "GET", "HEAD", "DELETE", "PUT", "OPTIONS", "post" }) {
            assertFalse(method, policy.allowsApi(method, "/clxuser/getmenulist"));
        }
    }

    @Test public void mainAppPolicyAddsAuthWithoutGrantingWritesOrWeakeningOfficialView() throws Exception {
        PortalPolicy app = new PortalPolicy(new JSONObject(new String(Files.readAllBytes(new File("src/main/assets/portal-api-policy.json").toPath()), StandardCharsets.UTF_8)));
        assertTrue(app.allowsApi("GET", "/token/getcaptcha"));
        for (String path : new String[] { "/token/pretoken-check", "/token/generatewebtoken", "/token/refreshTokenRequest" }) {
            assertTrue(app.allowsApi("POST", path));
            assertEquals(app.upstream + "/StudentPortalAPI" + path, app.apiUrl("POST", path).toString());
        }
        assertFalse(policy.allowsApi("GET", "/token/getcaptcha"));
        assertFalse(policy.allowsApi("POST", "/token/generatewebtoken"));
        for (String path : new String[] { "/onlinefeepayment/paynow", "/studentbankdetails/savestudentbankinfo",
            "/future/getSomething", "/token/generatewebtoken?x=1", "/../token/generatewebtoken", "https://evil.test/token/getcaptcha" }) {
            assertFalse(app.allowsApi("POST", path));
            assertThrows(SecurityException.class, () -> app.apiUrl("POST", path));
        }
        assertEquals(1, app.apiCapabilities().getInt("version"));
        assertTrue(app.apiCapabilities().getJSONArray("get").toString().contains("/token/getcaptcha"));
    }

    @Test public void assetsCannotBecomeAnApiOrAnExternalProxy() throws Exception {
        assertEquals(policy.upstream + "/studentportal/main.abcdef0123456789.js", policy.assetUrl(policy.origin + "/studentportal/main.abcdef0123456789.js").toString());
        assertEquals(policy.upstream + "/studentportal/", policy.assetUrl(policy.origin + policy.entry).toString());
        for (String url : new String[] {
            policy.origin + "/StudentPortalAPI/onlinefeepayment/paynow", policy.origin + "/api/clxuser/getmenulist",
            "https://lazyportal-tan.vercel.app/api/clxuser/getmenulist", "https://evil.test/studentportal/main.js",
            "https://studentportal.juet.ac.in.evil.test/studentportal/main.js",
            "https://user:secret@studentportal.juet.ac.in/studentportal/main.js",
            "https://studentportal.juet.ac.in:444/studentportal/main.js", "http://studentportal.juet.ac.in/studentportal/main.js",
            policy.origin + "/studentportal/../StudentPortalAPI/x.js", policy.origin + "/studentportal/%2e%2e/x.js",
            policy.origin + "/studentportal//x.js", policy.origin + "/studentportal/random.html",
        }) assertThrows(url, Exception.class, () -> policy.assetUrl(url));
        var font = policy.assetAliases.entrySet().iterator().next();
        assertEquals(font.getKey(), policy.assetUrl(policy.origin + font.getValue()).toString());
        assertThrows(Exception.class, () -> policy.assetUrl(font.getKey() + "?redirect=evil"));
    }

    @Test public void navigationStaysOnReviewedReadPages() {
        assertTrue(policy.allowsNavigation(policy.origin + policy.entry));
        assertTrue(policy.allowsNavigation(policy.origin + "/studentportal/#/student/myclassattendance"));
        for (String url : new String[] {
            policy.origin + "/studentportal/#/student/onlinefeepayments",
            policy.origin + "/studentportal/#/student/changepassword",
            policy.origin + "/somethingelse/dashbord", policy.origin + "/studentportal/?next=evil",
            policy.upstream + "/studentportal/", "javascript:alert(1)", "file:///etc/passwd",
        }) assertFalse(url, policy.allowsNavigation(url));
        assertTrue(policy.ownsOrigin(policy.origin));
        assertFalse(policy.ownsOrigin(policy.upstream));
        assertFalse(policy.ownsOrigin(policy.origin + ".evil.test"));
    }
}
