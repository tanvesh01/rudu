# frozen_string_literal: true

cask "rudu" do
  version "0.5.1"

  on_arm do
    sha256 "1d1291c03ce2d9218768906f7e8f52e42e0818bc8f5532b3e00a1d6301c850aa"
    url "https://github.com/tanvesh01/rudu/releases/download/v#{version}/rudu_#{version}_aarch64.dmg"
  end

  on_intel do
    sha256 "8a269079ff0af7030f4a4a60acfcc29b2f5854d967965116828fdc795b7b6249"
    url "https://github.com/tanvesh01/rudu/releases/download/v#{version}/rudu_#{version}_x64.dmg"
  end

  name "Rudu"
  desc "Review PRs without losing your mind"
  homepage "https://github.com/tanvesh01/rudu"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :big_sur

  app "rudu.app"

  zap trash: [
    "~/Library/Application Support/com.tanvesh.rudu",
    "~/Library/Preferences/com.tanvesh.rudu.plist",
    "~/Library/Saved Application State/com.tanvesh.rudu.savedState",
  ]

  caveats <<~EOS
    Rudu shells out to Git and the GitHub CLI for repository and pull request review.
    Install and authenticate gh if you want GitHub PR features:
      brew install gh
      gh auth login
  EOS
end
