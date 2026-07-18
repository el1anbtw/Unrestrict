# Active Chrome verification

Run `npm.cmd run serve:fixture`, load `extension` as an unpacked extension, and open
`http://127.0.0.1:8765/matrix.html`.

Verify in the active Chrome profile:

1. Before enabling the hostname, the fixture blocks the context menu and selection.
2. Enable the normal profile and confirm the tab reloads, selection works, and protected
   events are no longer canceled while ordinary input remains editable.
3. Switch to strong and verify the selection-clearing handler no longer removes selection.
4. Right-click the canvas overlay and confirm Chrome targets the underlying canvas.
5. Copy selected fixture text and verify the page cannot replace it with `corrupted`.
6. Paste into the input and contenteditable controls; formatting and text must survive.
7. Disable the site and confirm a reload restores the original blocked fixture behavior.
8. Inspect the fixture console for extension errors.
