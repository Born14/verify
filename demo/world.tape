# Demo A: "Wrong World Model"
# vhs < demo/world.tape

Output demo/world.gif

Set Shell "bash"
Set FontSize 14
Set Width 960
Set Height 580
Set Theme "Catppuccin Mocha"
Set Padding 20

Type "npx @sovereign-labs/verify demo --scenario=world --slow"
Sleep 500ms
Enter
Sleep 22s
