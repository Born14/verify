# Demo B: "The Silent Drift"
# vhs < demo/drift.tape

Output demo/drift.gif

Set Shell "bash"
Set FontSize 14
Set Width 960
Set Height 600
Set Theme "Catppuccin Mocha"
Set Padding 20

Type "npx @sovereign-labs/verify demo --scenario=drift --slow"
Sleep 500ms
Enter
Sleep 22s
