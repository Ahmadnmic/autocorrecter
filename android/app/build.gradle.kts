import java.util.Base64

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val ksB64 = System.getenv("KEYSTORE_B64")
val ksFile = layout.buildDirectory.file("release.p12").get().asFile
if (!ksB64.isNullOrBlank()) {
    ksFile.parentFile.mkdirs()
    ksFile.writeBytes(Base64.getDecoder().decode(ksB64))
}

android {
    namespace = "com.nmic.autocorrect"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.nmic.autocorrect"
        minSdk = 29
        targetSdk = 34 // 35 forces the IME window edge-to-edge on Android 15, putting the bottom row under the navigation bar
        versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("VERSION_NAME") ?: "0.1.0"
    }
    signingConfigs {
        create("release") {
            if (!ksB64.isNullOrBlank()) {
                storeFile = ksFile
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS") ?: "release"
                keyPassword = System.getenv("KEYSTORE_PASSWORD")
                storeType = "PKCS12"
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (!ksB64.isNullOrBlank()) signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
}
