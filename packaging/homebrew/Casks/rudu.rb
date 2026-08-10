# frozen_string_literal: true

cask "rudu" do
  version "0.5.0"

  on_arm do
    sha256 "12e1fd0c3d729db03459790981ef9a1519c292166d2a80d9cc48488aad0a3e3c"
    url "https://github.com/tanvesh01/rudu/releases/download/v#{version}/rudu_#{version}_aarch64.dmg"
  end

  on_intel do
    sha256 "a2481659dee6f9fa3adbc5d7d862f9b4ca3a560c3530e378c1a3a44e8b255261"
    url "https://github.com/tanvesh01/rudu/releases/download/v#{version}/rudu_#{version}_x64.dmg"
  end

  name "Rudu"
  desc "Review PRs without losing your mind"
  homepage "https://github.com/tanvesh01/rudu"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :big_sur"

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
