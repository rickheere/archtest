# archtest demo — run: vhs demo.tape

Output demo.gif
Output demo.mp4

Set Shell "bash"
Set FontSize 14
Set Width 900
Set Height 500
Set Theme "Catppuccin Mocha"
Set Padding 20
Set TypingSpeed 40ms

Type "archtest interview --base-dir tests/fixtures/monorepo-project/backend --ext .clj --import-pattern '\[([a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+)'"
Enter
Sleep 2s

Type "archtest interview --base-dir tests/fixtures/monorepo-project/backend --ext .clj --import-pattern '\[([a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+)' --page 3"
Enter
Sleep 2s

Type "archtest --config tests/fixtures/monorepo-project/backend/.archtest.yml --base-dir tests/fixtures/monorepo-project/backend"
Enter
Sleep 3s
