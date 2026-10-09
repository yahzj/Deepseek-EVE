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
	if OS.get_environment("WHALE_PLANET_SCENE_SET") == "1":
		definitions += [
			{"id": "desert", "scene": "DryTerran/DryTerran", "seed": 391, "colors": []},
			{"id": "ice", "scene": "IceWorld/IceWorld", "seed": 219, "colors": ["eef5fa", "accee0", "56738d", "74bed6", "3c7b9b", "1b3752", "f1f5fa", "c9dce9", "68879e", "3a536f"]},
			{"id": "lava", "scene": "LavaWorld/LavaWorld", "seed": 672, "colors": ["705b65", "3e354b", "231e34", "3e354b", "231e34", "ffbc67", "f46946", "a63740"]},
			{"id": "temperate", "scene": "Rivers/Rivers", "seed": 328, "colors": ["9bbb80", "63886a", "3d6058", "213b42", "8cb8cd", "3e7596", "eef1e4", "bcc9bc", "7a968c", "4c6269"]},
			{"id": "star-yellow", "scene": "Star/Star", "seed": 420, "colors": ["fff4bf", "fff4bf", "ffd26e", "f29453", "9c4844", "ffd26e", "fff4bf"]},
			{"id": "star-red", "scene": "Star/Star", "seed": 521, "colors": ["ffd9b2", "ffe4c7", "fba071", "dc6557", "832f44", "fba071", "ffe4c7"]},
			{"id": "star-blue", "scene": "Star/Star", "seed": 623, "colors": ["deefff", "f2f7ff", "a1d3ed", "5a91c5", "355b94", "a1d3ed", "f2f7ff"]},
			{"id": "star-white", "scene": "Star/Star", "seed": 729, "colors": ["f3f3ec", "ffffff", "e4e8e2", "9eacc8", "566d92", "e4e8e2", "ffffff"]},
			{"id": "black-hole", "scene": "BlackHole/BlackHole", "seed": 915, "colors": []}
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
		if colors.size() > 0:
			planet.set_colors(colors)
		else:
			for color in planet.get_colors():
				definition.colors.append(color.to_html(false))
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
