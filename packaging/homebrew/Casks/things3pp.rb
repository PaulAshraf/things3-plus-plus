# Homebrew cask for the things3pp Mac app. Published from a tap repo (e.g. PaulAshraf/homebrew-things3pp)
# by .github/workflows/release-mac.yml, which fills in the version and sha256.
cask "things3pp" do
  version "0.2.0"
  sha256 "REPLACED_BY_RELEASE_WORKFLOW"

  url "https://github.com/PaulAshraf/things3-plus-plus/releases/download/mac-v#{version}/things3pp-#{version}.dmg"
  name "things3pp"
  desc "Use your Things 3 to-dos on the web and from AI apps"
  homepage "https://github.com/PaulAshraf/things3-plus-plus"

  depends_on macos: ">= :sonoma"

  app "things3pp.app"

  uninstall quit:       "dev.things3pp.app",
            login_item: "things3pp"

  zap trash: [
    "~/Library/Preferences/dev.things3pp.app.plist",
  ]
end
