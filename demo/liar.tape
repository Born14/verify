# Demo E: "The Agent Said Done"
# vhs < demo/liar.tape

Output demo/liar.gif

Set Shell "bash"
Set FontSize 14
Set Width 960
Set Height 540
Set Theme "Catppuccin Mocha"
Set Padding 20

Type "npx @sovereign-labs/verify demo --scenario=liar --slow"
Sleep 500ms
Enter
Sleep 22s
