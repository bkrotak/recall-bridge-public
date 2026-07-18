plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

val signingPath = System.getenv("COUCHCODE_KEYSTORE_PATH")
val signingAlias = System.getenv("COUCHCODE_KEY_ALIAS")
val signingStorePassword = System.getenv("COUCHCODE_STORE_PASSWORD")
val signingKeyPassword = System.getenv("COUCHCODE_KEY_PASSWORD")
val signingReady = listOf(signingPath, signingAlias, signingStorePassword, signingKeyPassword).all { !it.isNullOrBlank() }

android {
    namespace = "com.couchcode.mobile"
    compileSdk = 35

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.couchcode.mobile"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("COUCHCODE_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("COUCHCODE_VERSION_NAME") ?: "0.1.0"
    }

    signingConfigs {
        if (signingReady) {
            create("release") {
                storeFile = file(signingPath!!)
                storePassword = signingStorePassword
                keyAlias = signingAlias
                keyPassword = signingKeyPassword
            }
        }
    }

    buildTypes {
        getByName("release") {
            if (signingReady) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
        }
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(platform("com.google.firebase:firebase-bom:33.8.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("androidx.core:core-ktx:1.15.0")
}
