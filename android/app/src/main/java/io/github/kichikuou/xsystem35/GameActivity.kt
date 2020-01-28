/* Copyright (C) 2019 <KichikuouChrome@gmail.com>
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
 *
*/
package io.github.kichikuou.xsystem35

import android.media.MediaPlayer
import android.os.Bundle
import android.util.Base64
import android.util.Log
import org.libsdl.app.SDLActivity
import java.io.File
import java.io.IOException

// Intent for this activity must have two extras:
// - EXTRA_GAME_ROOT (string): A path to the game installation.
// - EXTRA_TITLE_FILE (string): A file to which the game title will be written.
// - EXTRA_PLAYLIST_FILE (string): A path to the BGM playlist file.
class GameActivity : SDLActivity() {
    companion object {
        const val EXTRA_GAME_ROOT = "GAME_ROOT"
        const val EXTRA_TITLE_FILE = "TITLE_FILE"
        const val EXTRA_PLAYLIST_FILE = "PLAYLIST_FILE"
    }

    private lateinit var cdda: CddaPlayer
    private val midi = MidiPlayer()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cdda = CddaPlayer(File(intent.getStringExtra(EXTRA_PLAYLIST_FILE)))
    }

    override fun onStop() {
        super.onStop()
        cdda.onActivityStop()
        midi.onActivityStop()
    }

    override fun onResume() {
        super.onResume()
        cdda.onActivityResume()
        midi.onActivityResume()
    }

    override fun getLibraries(): Array<String> {
        return arrayOf("hidapi", "SDL2", "xsystem35")
    }

    override fun getArguments(): Array<String> {
        return arrayOf("-gamedir", intent.getStringExtra(EXTRA_GAME_ROOT))
    }

    override fun setTitle(title: CharSequence?) {
        super.setTitle(title)
        val str = title?.toString()?.substringAfter(':', "")
        if (str.isNullOrEmpty())
            return
        intent.getStringExtra(EXTRA_TITLE_FILE)?.let { File(it).writeText(str) }
    }

    // These functions are called in the SDL thread by JNI.
    @Suppress("unused") fun cddaStart(track: Int, loop: Int) = cdda.start(track, loop)
    @Suppress("unused") fun cddaStop() = cdda.stop()
    @Suppress("unused") fun cddaCurrentPosition() = cdda.currentPosition()
    @Suppress("unused") fun midiStart(buf: ByteArray, loop: Int) = midi.start(buf, loop)
    @Suppress("unused") fun midiStop() = midi.stop()
    @Suppress("unused") fun midiCurrentPosition() = midi.currentPosition()
}

private class CddaPlayer(private val playlistPath: File) {
    private val playlist =
        try {
            playlistPath.readLines()
        } catch (e: IOException) {
            Log.e("loadPlaylist", "Cannot load $playlistPath", e)
            emptyList<String>()
        }
    private var currentTrack = 0
    private val player = MediaPlayer()
    private var playerPaused = false

    fun start(track: Int, loop: Int) {
        val f = playlist.elementAtOrNull(track)
        if (f.isNullOrEmpty()) {
            Log.w("cddaStart", "No playlist entry for track $track")
            return
        }
        Log.v("cddaStart", f)
        try {
            player.apply {
                reset()
                setDataSource(File(playlistPath.parent, f).path)
                isLooping = loop == 0
                prepare()
                start()
            }
            currentTrack = track
        } catch (e: IOException) {
            Log.e("cddaStart", "Cannot play $f", e)
            player.reset()
        }
    }

    fun stop() {
        if (currentTrack > 0 && player.isPlaying) {
            player.stop()
            currentTrack = 0
        }
    }

    fun currentPosition(): Int {
        if (currentTrack == 0)
            return 0
        val frames = player.currentPosition * 75 / 1000
        return currentTrack or (frames shl 8)
    }

    fun onActivityStop() {
        if (currentTrack > 0 && player.isPlaying) {
            player.pause()
            playerPaused = true
        }
    }

    fun onActivityResume() {
        if (playerPaused) {
            player.start()
            playerPaused = false
        }
    }
}

private class MidiPlayer() {
    private val player = MediaPlayer()
    private var playing = false
    private var playerPaused = false

    fun start(buf: ByteArray, loop: Int) {
        val url = "data:audio/midi;base64," + Base64.encodeToString(buf, Base64.DEFAULT)
        try {
            player.apply {
                reset()
                setDataSource(url)
                isLooping = loop == 0
                prepare()
                start()
            }
            playing = true
        } catch (e: IOException) {
            Log.e("midiStart", "Cannot play midi", e)
            player.reset()
        }
    }

    fun stop() {
        if (playing && player.isPlaying) {
            player.stop()
            playing = false
        }
    }

    fun currentPosition(): Int {
        return if (playing) player.currentPosition else 0
    }

    fun onActivityStop() {
        if (playing && player.isPlaying) {
            player.pause()
            playerPaused = true
        }
    }

    fun onActivityResume() {
        if (playerPaused) {
            player.start()
            playerPaused = false
        }
    }
}
