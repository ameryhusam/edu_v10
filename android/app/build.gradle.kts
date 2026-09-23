plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("org.jetbrains.kotlin.plugin.compose")
}

android {
  namespace = "com.edu.questionbank"
  compileSdk = 35
  defaultConfig {
    applicationId = "com.edu.questionbank"
    minSdk = 26
    targetSdk = 35
    versionCode = 1
    versionName = "1.0"
  }
  buildFeatures { compose = true; buildConfig = true }
}

dependencies {
  implementation(platform("androidx.compose:compose-bom:2025.08.00"))
  implementation("androidx.activity:activity-compose:1.10.1")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.2")
  implementation("com.squareup.retrofit2:retrofit:2.11.0")
  implementation("com.squareup.retrofit2:converter-gson:2.11.0")
}
