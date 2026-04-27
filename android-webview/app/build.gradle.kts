plugins { id("com.android.application") }

android {
    namespace = "ai.kryp.openclaw"
    compileSdk = 33

    defaultConfig {
        applicationId = "ai.kryp.openclaw"
        minSdk = 23
        targetSdk = 33
        versionCode = 1
        versionName = "1.0.0"
    }
}

dependencies {
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
}
