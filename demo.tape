# archtest demo recording
# Run: vhs demo.tape
# Produces: demo.gif and demo.mp4

Output demo.gif
Output demo.mp4

Set Shell "bash"
Set FontSize 14
Set Width 900
Set Height 550
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 30ms

# Title
Type "# archtest — AI writes the rules, grep enforces them"
Enter
Sleep 1s

# Show the interview scanning a codebase
Type "archtest interview --base-dir tests/fixtures/monorepo-project/backend --ext .clj --import-pattern '\[([a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+)'"
Enter
Sleep 3s

# Show what a rule file looks like
Type "cat tests/fixtures/monorepo-project/backend/.archtest.yml"
Enter
Sleep 2s

# Run the rules — catch a violation
Type "archtest --config tests/fixtures/monorepo-project/backend/.archtest.yml --base-dir tests/fixtures/monorepo-project/backend"
Enter
Sleep 3s

Type "# Boundaries enforced. No AI at runtime. Just grep."
Enter
Sleep 2s
