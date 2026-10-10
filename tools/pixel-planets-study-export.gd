# PixelPlanets分辨率/分层研究，由pixel-planets-study.cjs启动，不进入游戏运行路径。
# Godot3.5/游戏v0.1.0/档v31，2026-10-10核对。
extends SceneTree

func _init():
	call_deferred("export_study")

func export_study():
	var output = OS.get_environment("WHALE_PLANET_STUDY_OUT")
	var manifest_path = OS.get_environment("WHALE_PLANET_STUDY_PARAMETERS")
	var file = File.new()
	if output == "" or file.open(manifest_path, File.READ) != OK:
		printerr("Missing study inputs")
		quit(1)
		return
	var parsed = JSON.parse(file.get_as_text())
	file.close()
	if parsed.error != OK:
		quit(1)
		return
	var definitions = parsed.result
	definitions += [
		{"id": "gas-clouds", "scene": "GasPlanet/GasPlanet", "seed": 846, "colors": []},
		{"id": "asteroid", "scene": "Asteroids/Asteroid", "seed": 313, "colors": []},
		{"id": "galaxy", "scene": "Galaxy/Galaxy", "seed": 715, "colors": []}
	]
	# 四色恒星使用相同三层结构，对照只选黄色以覆盖GUI的12个预设。
	var manifest = []
	for definition in definitions:
		if definition.id in ["star-red", "star-blue", "star-white"]:
			continue
		for pixel_count in [128, 1024]:
			var dithers = [true]
			if pixel_count == 1024 and definition.id in ["star-yellow", "ocean"]:
				dithers.append(false)
			for should_dither in dithers:
				# JSON数字是实数，原生set_seed使用取模，须按原GUI整数种子传递。
				seed(int(definition.seed))
				var scene = load("res://Planets/" + definition.scene + ".tscn")
				if scene == null:
					printerr("Missing scene: " + definition.scene)
					quit(1)
					return
				var planet = scene.instance()
				var viewport = Viewport.new()
				var padding = 16
				var span = int(pixel_count * planet.relative_scale)
				viewport.size = Vector2(span + padding * 2, span + padding * 2)
				viewport.transparent_bg = true
				viewport.usage = Viewport.USAGE_2D
				viewport.render_target_update_mode = Viewport.UPDATE_ALWAYS
				get_root().add_child(viewport)
				viewport.add_child(planet)
				planet.override_time = true
				planet.set_pixels(pixel_count)
				planet.rect_position = Vector2(padding, padding) + Vector2.ONE * pixel_count * 0.5 * (planet.relative_scale - 1)
				planet.set_seed(int(definition.seed))
				planet.set_light(Vector2(0.25, 0.25))
				planet.set_rotate(0.15)
				planet.set_dither(should_dither)
				var colors = []
				for hex in definition.colors:
					colors.append(Color(hex))
				if colors.size() > 0:
					planet.set_colors(colors)
				planet.set_custom_time(0.17)
				for _frame in range(3):
					yield(self, "idle_frame")
				VisualServer.force_draw()
				yield(VisualServer, "frame_post_draw")
				var image = viewport.get_texture().get_data()
				image.flip_y()
				var name = definition.id + "-" + str(pixel_count) + ("-dither" if should_dither else "-plain")
				if image.save_png(output.plus_file(name + ".png")) != OK:
					quit(1)
					return
				var layers = []
				for layer in planet.get_children():
					if layer is ColorRect:
						layers.append({"name": layer.name, "pixels": layer.material.get_shader_param("pixels"), "width": layer.rect_size.x, "height": layer.rect_size.y,
							"seed": layer.material.get_shader_param("seed"), "time": layer.material.get_shader_param("time"), "noiseSize": layer.material.get_shader_param("size"), "octaves": layer.material.get_shader_param("OCTAVES")})
				manifest.append({"id": definition.id, "name": name, "scene": definition.scene, "seed": definition.seed, "pixels": pixel_count, "dither": should_dither, "relativeScale": planet.relative_scale, "width": image.get_width(), "height": image.get_height(), "layers": layers})
				print("Exported " + name)
				viewport.queue_free()
				yield(self, "idle_frame")
	if file.open(output.plus_file("parameters.json"), File.WRITE) != OK:
		quit(1)
		return
	file.store_string(JSON.print(manifest, "  "))
	file.close()
	quit(0)
