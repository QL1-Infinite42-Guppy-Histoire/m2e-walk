package one.guppyguide.m2ewalk.stepcounter

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Reads Sensor.TYPE_STEP_COUNTER — the hardware step counter whose value is
 * cumulative since device boot and keeps increasing while the app is closed.
 *
 * The module deliberately returns only the RAW cumulative value. Turning it
 * into per-day steps (baseline handling, reboot detection) is done by the
 * shared delta logic in the app / server so it can be unit-tested.
 *
 * Requires the ACTIVITY_RECOGNITION runtime permission on Android 10+;
 * the app requests it via PermissionsAndroid before calling.
 */
class StepCounterModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("StepCounter")

    Function("hasStepCounter") {
      val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
      sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null
    }

    Function("hasActivityRecognitionPermission") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        true
      } else {
        ContextCompat.checkSelfPermission(
          context, Manifest.permission.ACTIVITY_RECOGNITION
        ) == PackageManager.PERMISSION_GRANTED
      }
    }

    // One-shot read: TYPE_STEP_COUNTER delivers its current cumulative value
    // as the first event after registering a listener.
    AsyncFunction("getCurrentStepCounter") Coroutine {
      readCurrentCounter()
    }
  }

  private suspend fun readCurrentCounter(): Double {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.ACTIVITY_RECOGNITION) != PackageManager.PERMISSION_GRANTED
    ) {
      throw StepCounterException("PERMISSION_DENIED", "ACTIVITY_RECOGNITION is not granted")
    }
    val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    val sensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
      ?: throw StepCounterException("NO_SENSOR", "This device has no TYPE_STEP_COUNTER sensor")

    return suspendCancellableCoroutine { continuation ->
      val resumed = AtomicBoolean(false)
      val listener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
          if (resumed.compareAndSet(false, true)) {
            sensorManager.unregisterListener(this)
            continuation.resume(event.values[0].toDouble())
          }
        }
        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
      }
      val handlerThread = android.os.HandlerThread("step-counter-read").apply { start() }
      val handler = android.os.Handler(handlerThread.looper)
      // Timeout guard: if no event arrives (sensor stalled), fail cleanly.
      handler.postDelayed({
        if (resumed.compareAndSet(false, true)) {
          sensorManager.unregisterListener(listener)
          continuation.resumeWithException(
            StepCounterException("TIMEOUT", "No step counter event within 5 seconds")
          )
        }
        handlerThread.quitSafely()
      }, 5000)
      val registered = sensorManager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_NORMAL, handler)
      if (!registered) {
        handlerThread.quitSafely()
        throw StepCounterException("REGISTER_FAILED", "Could not register the step counter listener")
      }
      continuation.invokeOnCancellation {
        sensorManager.unregisterListener(listener)
        handlerThread.quitSafely()
      }
    }
  }
}

class StepCounterException(code: String, message: String) :
  expo.modules.kotlin.exception.CodedException(code, message, null)
