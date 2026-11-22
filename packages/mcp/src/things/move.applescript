-- Moves a to-do or project to a built-in list (Inbox, Anytime, Someday).
-- Lives in AppleScript because JXA's `move` sends an Apple event Things can't handle (-1700).
-- SECURITY: ids arrive as argv and are never part of the script text.
on run argv
	tell application "Things3" to move to do id (item 1 of argv) to list id (item 2 of argv)
	return "{\"ok\":true}"
end run
