# PixelPlanets 3.5透明样片导出。由pixel-planets-samples.cjs启动，不成为游戏依赖。
# 版本自检：Godot3.5 / 游戏v0.1.0 / 档v31，2026-10-09。
extends SceneTree

func _init():
	call_deferred("export_samples")

func export_samples():
	var output = OS.get_environment("WHALE_PLANET_SAMPLE_OUT")
	if output == "":
		printerr("Missing sample output directory")
		quit(1)
		return
	var definitions = [
		{"id": "rocky", "scene": "NoAtmosphere/NoAtmosphere", "seed": 127, "colors": ["b4b7c2", "757b92", "363c56", "757b92", "363c56"]},
		{"id": "ocean", "scene": "LandMasses/LandMasses", "seed": 583, "colors": ["7acbd5", "3172a3", "172946", "a4c99b", "6f9980", "3b6964", "1a3542", "e8edf0", "bdcddc", "637e9c", "374861"]},
		{"id": "gas", "scene": "GasPlanetLayers/GasPlanetLayers", "seed": 846, "colors": ["edcc9b", "c18d82", "796782", "856578", "51435f", "292c47"]}
	]
	var manifest = []
	for definition in definitions:
		seed(definition.seed)
		var scene = load("res://Planets/" + definition.scene + ".tscn")
		if scene == null:
			printerr("Missing PixelPlanets scene: " + definition.scene)
			quit(1)
			return
		var planet = scene.instance()
		var viewport = Viewport.new()
		var pixels = 256
		var padding = 16
		var span = int(pixels * planet.relative_scale)
		viewport.size = Vector2(span + padding * 2, span + padding * 2)
		viewport.transparent_bg = true
		viewport.usage = Viewport.USAGE_2D
		viewport.render_target_update_mode = Viewport.UPDATE_ALWAYS
		get_root().add_child(viewport)
		viewport.add_child(planet)
		planet.override_time = true
		planet.set_pixels(pixels)
		planet.rect_position = Vector2(padding, padding) + Vector2.ONE * pixels * 0.5 * (planet.relative_scale - 1)
		planet.set_seed(definition.seed)
		planet.set_light(Vector2(0.25, 0.25))
		planet.set_rotate(0.15)
		planet.set_dither(true)
		var colors = []
		for hex in definition.colors:
			colors.append(Color(hex))
		planet.set_colors(colors)
		planet.set_custom_time(0.17)
		for _frame in range(3):
			yield(self, "idle_frame")
		VisualServer.force_draw()
		yield(VisualServer, "frame_post_draw")
		var image = viewport.get_texture().get_data()
		image.flip_y()
		var destination = output.plus_file(definition.id + ".png")
		var error = image.save_png(destination)
		if error != OK:
			printerr("PNG export failed: " + str(error))
			quit(1)
			return
		manifest.append({"id": definition.id, "scene": definition.scene, "seed": definition.seed, "colors": definition.colors,
			"pixels": pixels, "padding": padding, "width": image.get_width(), "height": image.get_height(),
			"light": [0.25, 0.25], "rotation": 0.15, "time": 0.17, "dither": true})
		print("Exported " + destination)
		viewport.queue_free()
		yield(self, "idle_frame")
	var file = File.new()
	if file.open(output.plus_file("parameters.json"), File.WRITE) != OK:
		quit(1)
		return
	file.store_string(JSON.print(manifest, "  "))
	file.close()
	quit(0)
