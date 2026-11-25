on launchBridge()
    set bridgePath to POSIX path of (path to me) & "Contents/Resources/runtime/obs-bridge"
    do shell script (quoted form of bridgePath & " </dev/null >/dev/null 2>&1 &")
end launchBridge

on run
    my launchBridge()
end run

on open location ignoredURL
    my launchBridge()
end open location
