/**
 * 手机端 TLS 身份：应用私有软件密钥规避该华为硬件 Keymaster 的 TLS 签名兼容故障。
 */
package dev.androidautodesk.host

import android.content.Context
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.SecureRandom
import java.util.Date
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext

internal object CompanionTls {
    private const val FILE_NAME = "companion-identity.p12"
    private const val ALIAS = "droidstage-companion"

    /** 首次启动生成每台安装独有的证书与私钥，后续从应用私有目录加载。 */
    fun context(context: Context): SSLContext {
        val file = context.getFileStreamPath(FILE_NAME)
        val password = password(context)
        val store = KeyStore.getInstance("PKCS12")
        if (file.exists()) {
            file.inputStream().use { store.load(it, password) }
        } else {
            store.load(null, password)
            val keys = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
            val start = Date(System.currentTimeMillis() - 60000)
            val end = Date(System.currentTimeMillis() + 20L * 365 * 24 * 60 * 60 * 1000)
            val subject = X500Name("CN=DroidStage Companion")
            val builder = JcaX509v3CertificateBuilder(subject, BigInteger(128, SecureRandom()),
                start, end, subject, keys.public)
            val signer = JcaContentSignerBuilder("SHA256withRSA").build(keys.private)
            val certificate = JcaX509CertificateConverter().getCertificate(builder.build(signer))
            store.setKeyEntry(ALIAS, keys.private, password, arrayOf(certificate))
            context.openFileOutput(FILE_NAME, Context.MODE_PRIVATE).use { store.store(it, password) }
        }
        val managers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
        managers.init(store, password)
        return SSLContext.getInstance("TLS").apply { init(managers.keyManagers, null, null) }
    }

    private fun password(context: Context): CharArray {
        val prefs = context.getSharedPreferences("companion", Context.MODE_PRIVATE)
        val saved = prefs.getString("identityPassword", null)
        if (saved != null) return saved.toCharArray()
        val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val generated = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        prefs.edit().putString("identityPassword", generated).commit()
        return generated.toCharArray()
    }
}
