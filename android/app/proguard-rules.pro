# Services and the activity are referenced from the manifest, so R8 keeps them. Strip logging from release builds.
-assumenosideeffects class android.util.Log { public static *** d(...); public static *** v(...); public static *** i(...); }
