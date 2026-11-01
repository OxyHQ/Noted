Pod::Spec.new do |s|
  s.name = 'NotedAudioErasure'
  s.version = '0.1.0'
  s.summary = 'Confined, idempotent deletion of Noted audio'
  s.description = s.summary
  s.license = 'MIT'
  s.author = 'Oxy'
  s.homepage = 'https://oxy.so'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/OxyHQ/Noted.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
end
