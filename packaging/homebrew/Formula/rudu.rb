# frozen_string_literal: true

class Rudu < Formula
  desc "Review PRs without losing your mind"
  homepage "https://github.com/tanvesh01/rudu"
  url "https://github.com/tanvesh01/rudu/releases/download/v0.5.0/rudu_0.5.0_amd64.AppImage"
  version "0.5.0"
  sha256 "b6619c43b9a06c3932290411f12ca0d4be965cbfbb6f79e787e443f4bc9224a1"
  license "MIT"

  livecheck do
    url :stable
    regex(%r{/download/v?(\d+(?:\.\d+)+)/rudu[._-]}i)
  end

  depends_on arch: :x86_64
  depends_on :linux

  def install
    libexec.install stable.cached_download => "rudu.AppImage"
    chmod 0755, libexec/"rudu.AppImage"

    (bin/"rudu").write <<~SH
      #!/bin/sh
      exec "#{libexec}/rudu.AppImage" "$@"
    SH
    chmod 0755, bin/"rudu"
  end

  def caveats
    <<~EOS
      Rudu is distributed on Linux through its upstream AppImage.
      If your distribution does not provide FUSE for AppImages, install the
      appropriate fuse package or run the AppImage with --appimage-extract.

      Rudu shells out to Git and the GitHub CLI for repository and pull request review.
      Install and authenticate gh if you want GitHub PR features:
        brew install gh
        gh auth login
    EOS
  end

  test do
    assert_path_exists libexec/"rudu.AppImage"
    assert_match "AppImage", shell_output("#{bin}/rudu --appimage-help 2>&1")
  end
end
