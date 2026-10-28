# SpicyTUI
<img width="645" height="274" alt="image" src="https://github.com/user-attachments/assets/f1cea4b4-5705-480a-8bcd-260440041b60" />

A terminal-style command line for Spotify, built as a [Spicetify](https://spicetify.app/) extension to sit on top of [Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics).

Type `/` anywhere, run a command, and get IDE-style autocomplete.

- Search and play songs, artists, albums and your own playlists, with random-song flags (`-r`)
- Playback, queue, volume, seek, like, add-to-playlist and more, all from the keyboard
- Spicy Lyrics layout tweaks: song title above the poster (shown on hover), and poster buttons only appear when the cursor is on the poster
- `Ctrl/Cmd + F` toggles Spicy Lyrics fullscreen (enter and exit)

## Requirements

1. **Spotify desktop app** (not the web player)
2. **[Spicetify CLI](https://spicetify.app/docs/getting-started)**, installed and applied at least once
3. **[Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics)**, installed through the Spicetify Marketplace or manually


## Install

1. Find your Spicetify config folder:

   ```sh
   spicetify config-dir
   ```

2. Open the `Extensions` folder inside it.

3. Put `spicy-tui.js` in that folder, either way:

   - **Clone / pull** (then copy the file in, or clone straight into `Extensions` and use `SpicyTUI/spicy-tui.js` as the path in step 4):

     ```sh
     git clone https://github.com/AbbosJabborov/SpicyTUI.git
     ```

     To update later: `git pull`, then copy the file again.
   - **Download**: grab the ZIP from GitHub, unzip it, and paste `spicy-tui.js` into `Extensions`.

4. Enable it and apply:

   ```sh
   spicetify config extensions spicy-tui.js && spicetify apply
   ```

After each Spotify update, run `spicetify apply` again if the prompt disappears.

## Uninstall

```sh
spicetify config extensions spicy-tui.js-
spicetify apply
```

## Usage

Press `/` to focus the prompt (or click it), type a command, and use the list that appears.

| Key | Action |
| --- | --- |
| `/` | Focus the prompt |
| `Tab` | Complete the highlighted match (or the first one). Never plays |
| `Enter` | Run the command. After `Tab`, plays that exact match |
| `↑` / `↓` | Move the highlight. On an empty prompt: command history |
| `Esc` | Clear and leave the prompt |
| `Ctrl/Cmd + F` | Toggle Spicy Lyrics fullscreen |

Typing text without a `/` searches songs. Add `-r` or `--random` to `/artist`, `/playlist` and `/liked` to play a random song.

### Commands

| Command | What it does |
| --- | --- |
| `/song <name>` | search and play a song |
| `/artist <name> [song words] [-r]` | play an artist or one of their songs; `-r` = random from "This Is" |
| `/album <name>` | search and play an album |
| `/playlist <name> [-r]` | play one of your playlists; `-r` = random song from it |
| `/liked [-r]` | play Liked Songs; `-r` = random song |
| `/recent [filter]` | pick from recently played songs |
| `/lucky` | random song from a random playlist of yours |
| `/radio` | start a radio from the current song |
| `/next` (`/n`), `/prev` (`/p`) | next / previous song |
| `/pause`, `/play`, `/toggle` | pause, resume, or toggle |
| `/restart` | jump to the start of the song |
| `/seek <time>` | `1:30` jumps there, `+10` / `-10` skips seconds |
| `/vol <0-100>` | set the volume, or `+5` / `-5` to change it |
| `/shuffle [on\|off]` | toggle shuffle, or set it |
| `/repeat [off\|all\|one]` | cycle repeat, or set it |
| `/queue <song>` | add a song to the end of the queue (`/queue clear` empties it) |
| `/playnext <song>` | make a song play right after the current one |
| `/like`, `/unlike` | like / unlike the current song |
| `/add <playlist>` | add the current song to one of your playlists |
| `/now` | show the current song |
| `/goto <artist\|album>` | open the current song's artist or album page |
| `/copy` | copy the current song's link |
| `/lyrics` | open or close the Spicy Lyrics page |
| `/fullscreen` | toggle Spicy Lyrics fullscreen |
| `/romanize` | toggle romanized lyrics (Spicy page must be open) |
| `/sleep <minutes\|off>` | pause playback after a delay |
| `/clear` | clear the prompt and messages |
| `/help [command]` | list commands, or details for one (`/help keys` for shortcuts) |

## Customizing

The layout values sit at the top of the CSS block inside `spicy-tui.js`:

| Variable | Default | Controls |
| --- | --- | --- |
| `--stui-lift` | `40px` | how far the poster is raised |
| `--stui-meta-h` | `78px` | height reserved for the title above the poster |
| `--stui-meta-gap` | `16px` | gap between title and poster |
| `--stui-left` | `8.75vw` | prompt distance from the left edge |
| `--stui-base` | `9vh` | prompt distance from the bottom |
| `--stui-width` | `max(380px, 33vw)` | prompt and list width |

## Troubleshooting

- **Nothing shows up**: confirm `spicetify config extensions` lists `spicy-tui.js`, then run `spicetify apply` again. Press `Ctrl+Shift+I` in Spotify (or enable developer mode) to check the console for errors.
- **Search shows "search failed" or "no matches"**: Spotify's internal search can change between versions. The message in the status line above the prompt tells you what failed.
- **`/radio` does nothing**: it uses a Spotify station link that some versions reject. The status line says so after a couple of seconds.
- **`/playnext` adds to the end**: it rebuilds the queue and falls back to appending if Spotify's queue data looks different.
- **`/recent` is short**: if Spotify's recently-played request fails, it falls back to songs played while the extension was running.
- **Layout looks off**: adjust the variables above. Spicy Lyrics' own CSS changes between versions.

## Credits

- [Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics) by Spikerko
- Inspired by [SpoTUI](https://github.com/SkenSMasteR/SpoTUI) by SkenS
