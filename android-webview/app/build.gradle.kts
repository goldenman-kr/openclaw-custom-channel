plugins { id("com.android.application") }

val openClawStartUrl = providers.gradleProperty("openclawStartUrl")
    .orElse(providers.environmentVariable("OPENCLAW_START_URL"))
    .orElse("http://10.0.2.2:29999/")
    .get()
val openClawAllowedHost = providers.gradleProperty("openclawAllowedHost")
    .orElse(providers.environmentVariable("OPENCLAW_ALLOWED_HOST"))
    .orElse(java.net.URI(openClawStartUrl).host ?: "10.0.2.2")
    .get()

android {
    namespace = "ai.kryp.openclaw"
    compileSdk = 33

    defaultConfig {
        applicationId = "ai.kryp.openclaw"
        minSdk = 23
        targetSdk = 33
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "START_URL", "\"$openClawStartUrl\"")
        buildConfigField("String", "ALLOWED_HOST", "\"$openClawAllowedHost\"")
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
}
