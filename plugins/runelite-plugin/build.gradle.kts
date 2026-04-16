import java.io.File
import org.gradle.api.tasks.Copy
import org.gradle.api.tasks.JavaExec
import org.gradle.api.tasks.SourceSetContainer
import org.gradle.jvm.tasks.Jar

plugins {
    java
}

group = "dev.rune.xr"
version = "0.1.0"

val runeLiteVersion = "latest.release"
val pluginMainClass = "dev.rune.xr.runelite.RuneXrPluginTest"
val isMacOs = System.getProperty("os.name").contains("mac", ignoreCase = true)
val realUserHome = File(System.getProperty("user.home"))
val realRuneLiteDir = File(realUserHome, ".runelite")
val realCredentialsFile = File(realRuneLiteDir, "credentials.properties")
val runeliteDevHome = System.getenv("RUNELITE_DEV_HOME")
    ?.let(::File)
    ?: layout.buildDirectory.dir("runelite-dev-home").get().asFile
val sideloadDirectory = System.getenv("RUNELITE_SIDELOAD_DIR")
    ?.let(::File)
    ?: File(System.getProperty("user.home"), ".runelite/sideloaded-plugins")
val sourceSets = extensions.getByType<SourceSetContainer>()

repositories {
    mavenCentral()
    maven("https://repo.runelite.net")
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

dependencies {
    compileOnly("javax.inject:javax.inject:1")
    compileOnly("net.runelite:client:$runeLiteVersion")

    testImplementation("net.runelite:client:$runeLiteVersion")
    testImplementation("net.runelite:jshell:$runeLiteVersion")
    testImplementation(platform("org.junit:junit-bom:5.12.1"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.processResources {
    from(layout.projectDirectory.file("runelite-plugin.properties"))
}

tasks.register<JavaExec>("run") {
    group = "runelite"
    description = "Launches RuneLite with the Rune XR plugin loaded in developer mode"
    dependsOn(tasks.testClasses)
    classpath = sourceSets.named("test").get().runtimeClasspath
    mainClass.set(pluginMainClass)
    doFirst {
        runeliteDevHome.mkdirs()

        val devRuneLiteDir = File(runeliteDevHome, ".runelite")
        devRuneLiteDir.mkdirs()

        if (runeliteDevHome != realUserHome && realCredentialsFile.isFile())
        {
            realCredentialsFile.copyTo(File(devRuneLiteDir, realCredentialsFile.name), overwrite = true)
        }
    }

    workingDir = projectDir
    systemProperty("user.home", runeliteDevHome.absolutePath)
    jvmArgs(
        "-ea",
        "-XX:+DisableAttachMechanism",
        "-Xmx768m",
        "-Xss2m",
        "--add-opens=java.base/java.net=ALL-UNNAMED",
        "--add-opens=java.base/java.io=ALL-UNNAMED",
        "--add-opens=java.base/java.lang.reflect=ALL-UNNAMED"
    )
    if (isMacOs)
    {
        jvmArgs(
            "--add-opens=java.desktop/com.apple.eawt=ALL-UNNAMED",
            "-Dsun.java2d.metal=false",
            "-Dsun.java2d.opengl=true",
            "-Dapple.awt.application.appearance=system"
        )
    }
    args("--developer-mode", "--debug", "--insecure-write-credentials")
}

tasks.register<Copy>("installSideloadPlugin") {
    group = "runelite"
    description = "Copies the plugin jar into RuneLite's sideloaded-plugins directory"
    val jarTask = tasks.named<Jar>("jar")
    dependsOn(jarTask)
    from(jarTask.flatMap { it.archiveFile })
    into(sideloadDirectory)
}

tasks.test {
    useJUnitPlatform()
}
