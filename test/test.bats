#!/usr/bin/env bats

# Tests for gh-my-starred

@test "Script exists and is executable" {
  [ -f "./gh-my-starred" ]
  [ -x "./gh-my-starred" ]
}

@test "Script has valid bash syntax" {
  bash -n ./gh-my-starred
}

@test "Help flag shows usage information" {
  run ./gh-my-starred --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"USAGE"* ]]
  [[ "$output" == *"gh my-starred"* ]]
}

@test "Version flag shows version" {
  run ./gh-my-starred --version
  [ "$status" -eq 0 ]
  [[ "$output" == *"0.1.0"* ]]
}

@test "Invalid option shows error" {
  run ./gh-my-starred --invalid
  [ "$status" -eq 1 ]
  [[ "$output" == *"Error"* ]]
}

@test "AI docs flag works" {
  run ./gh-my-starred --ai
  [ "$status" -eq 0 ]
  [[ "$output" == *"gh-my-starred"* ]] || [[ "$output" == *"AI Assistant Guide"* ]]
}

@test "PI extension file exists" {
  [ -f ".pi/extensions/gh-my-starred.ts" ]
}

@test "SKILL.md exists" {
  [ -f "SKILL.md" ]
  [[ "$(head -1 SKILL.md)" == "---" ]]
}

@test "LICENSE exists" {
  [ -f "LICENSE" ]
  [[ "$(head -1 LICENSE)" == "MIT License"* ]] || [[ "$(head -1 LICENSE)" == *"MIT"* ]]
}

@test "README.md has required sections" {
  [ -f "README.md" ]
  [[ "$(cat README.md)" == *"## Installation"* ]]
  [[ "$(cat README.md)" == *"## Usage"* ]]
  [[ "$(cat README.md)" == *"## Features"* ]]
}
